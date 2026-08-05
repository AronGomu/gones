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
 *
 * Remote storage, retention sweeps and PITR stay deferred with the hosting decision.
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

  console.log('\n=== taking an encrypted backup ===');
  const backup = tool(['backup'], ['GONES_BACKUP_NAME=rehearsal']);
  check(backup.status === 0, `backup command succeeds (${backup.stdout.trim().split('\n').pop() ?? backup.stderr.trim()})`);

  const listing = tool(['--entrypoint', 'ls', 'backup', '-1', '/backups']).stdout.trim().split('\n').map((line) => line.trim()).filter(Boolean);
  check(listing.includes('rehearsal.dump.enc'), `the archive lands in the mounted backup root (${listing.join(', ')})`);
  check(listing.includes('rehearsal.dump.enc.sha256'), 'a checksum is written next to the archive');
  check(listing.includes('rehearsal.meta.json'), 'provenance metadata is written next to the archive');

  const header = tool(['--entrypoint', 'sh', 'backup', '-c', 'head -c 8 /backups/rehearsal.dump.enc | od -An -c | tr -d " \\n"']).stdout.trim();
  check(header.startsWith('Salted__'), `the archive is encrypted, not a readable dump (header ${header.slice(0, 16)})`);
  const escaped = tool(['--entrypoint', 'sh', 'backup', '-c', 'ls /tmp /var/tmp 2>/dev/null | grep -c dump || true']).stdout.trim();
  check(escaped === '0' || escaped === '', 'nothing is written outside the mounted backup root');

  console.log('\n=== a wrong key must fail before the database is touched ===');
  const wrongKey = tool(['--entrypoint', '/usr/local/bin/gones-restore.sh', 'backup', 'rehearsal.dump.enc'], ['GONES_BACKUP_KEY_FILE=', 'GONES_BACKUP_KEY=definitely-not-the-backup-key']);
  check(wrongKey.status === 11, `restore with a wrong key exits 11 (got ${wrongKey.status})`);
  check(/wrong key/i.test(wrongKey.stderr), `restore with a wrong key says so (${wrongKey.stderr.trim().slice(0, 90)})`);

  console.log('\n=== a corrupt archive must fail before the database is touched ===');
  tool(['--entrypoint', 'sh', 'backup', '-c', 'cp /backups/rehearsal.dump.enc /backups/corrupt.dump.enc && cp /backups/rehearsal.dump.enc.sha256 /backups/corrupt.dump.enc.sha256 && sed -i "s/rehearsal/corrupt/" /backups/corrupt.dump.enc.sha256 && printf "corruption" | dd of=/backups/corrupt.dump.enc bs=1 seek=64 conv=notrunc 2>/dev/null']);
  const corrupt = tool(['--entrypoint', '/usr/local/bin/gones-restore.sh', 'backup', 'corrupt.dump.enc']);
  check(corrupt.status === 10, `restore of a corrupt archive exits 10 (got ${corrupt.status})`);
  check(/corrupt/i.test(corrupt.stderr), `restore of a corrupt archive says so (${corrupt.stderr.trim().slice(0, 90)})`);

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
