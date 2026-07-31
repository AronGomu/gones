import { spawnSync } from 'node:child_process';

function docker(args, allowFailure = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!allowFailure && result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

const dedupeKey = 'c06-local-notification-smoke';
docker(['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-v', 'ON_ERROR_STOP=1', '-c', `DELETE FROM notification_outbox WHERE dedupe_key = '${dedupeKey}';`]);
docker(['compose', 'exec', '-T', 'worker', 'sh', '-ec', 'rm -rf /tmp/gones-email-sink && mkdir -p /tmp/gones-email-sink']);
docker(['compose', 'run', '--rm', 'migrator', 'notifications', 'enqueue-test']);

let state = '';
let fileCount = '0';
for (let attempt = 0; attempt < 120; attempt++) {
  state = docker(['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'gones_migration', '-d', 'gones', '-Atc', `SELECT status || '|' || (recipient IS NULL)::text || '|' || (template_model_json IS NULL)::text FROM notification_outbox WHERE dedupe_key = '${dedupeKey}';`]);
  fileCount = docker(['compose', 'exec', '-T', 'worker', 'sh', '-ec', "find /tmp/gones-email-sink -maxdepth 1 -type f -name '*.json' | wc -l"]);
  if (state === 'Sent|true|true' && fileCount === '1') break;
  await new Promise(resolve => setTimeout(resolve, 250));
}

if (state !== 'Sent|true|true') throw new Error(`Notification terminal state invalid: ${state || '(missing)'}`);
if (fileCount !== '1') throw new Error(`Expected one fake delivery marker; got ${fileCount}`);
const preview = docker(['compose', 'exec', '-T', 'worker', 'sh', '-ec', "find /tmp/gones-email-sink -maxdepth 1 -type f -name '*.json' -exec cat {} \\;"]);
if (preview.includes('local-test-token')) throw new Error('Notification sink leaked action token.');
if (preview.includes('local-recipient@example.test')) throw new Error('Notification sink leaked recipient.');
console.log('Notification outbox smoke passed: one fake delivery, terminal payload scrubbed.');
